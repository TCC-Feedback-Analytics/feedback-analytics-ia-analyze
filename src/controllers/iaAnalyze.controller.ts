import type { Request, Response } from 'express';
import {
  IaAnalyzeServiceError,
  runIaAnalyzeService,
  type LlmCreds,
} from '../services/iaAnalyze.service.js';
import { isInternalRequestAuthorized } from '../utils/isInternalRequestAuthorized.js';
import { isValidRemotePayload } from '../validations/iaAnalyze.validation.js';
import type { IaAnalyzeRemoteRunResponse } from '@feedback/lib-shared/interfaces/contracts/ia-analyze/remote.contract';

/** Primeiro valor não-vazio de um header (Express pode dar string ou string[]). */
function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Credenciais do LLM por requisição (Camada 2 / BYO-key): o gateway envia
 * `x-llm-provider/x-llm-api-key/x-llm-model` (a chave da empresa). Ausentes ⇒
 * `undefined` ⇒ o service cai na config do env (fallback global).
 * IMPORTANTE: nunca logar esses headers (a chave é sensível).
 */
function readLlmCreds(req: Request): LlmCreds | undefined {
  const provider = firstHeader(req.headers['x-llm-provider']);
  const apiKey = firstHeader(req.headers['x-llm-api-key']);
  const model = firstHeader(req.headers['x-llm-model']);
  if (!provider && !apiKey && !model) return undefined;
  return { provider, apiKey, model };
}

/**
 * Controller responsável por receber requisições de análise de feedbacks via IA.
 *
 * - Valida autorização interna e o payload recebido
 * - Chama o serviço principal de análise (runIaAnalyzeService)
 * - Retorna o resultado ou erro apropriado para o cliente
 *
 * Garante respostas HTTP corretas para cada cenário de erro ou sucesso.
 */
export async function analyzeController(req: Request, res: Response) {
  if (!isInternalRequestAuthorized(req)) {
    return res.status(401).json({
      error: 'unauthorized_internal_request',
      message: 'Missing or invalid internal token',
    });
  }

  const body = req.body;

  if (!isValidRemotePayload(body)) {
    return res.status(400).json({
      error: 'invalid_payload',
      message: 'enterprise_context and batches are required',
    });
  }

  try {
    const result = await runIaAnalyzeService(body, readLlmCreds(req));

    return res.status(200).json(result satisfies IaAnalyzeRemoteRunResponse);
  } catch (error) {
    if (error instanceof IaAnalyzeServiceError) {
      return res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      });
    }

    console.error('[ia-analyze] unexpected error:', error);

    return res.status(500).json({
      error: 'internal_server_error',
      message: 'Unexpected error while processing IA analysis',
    });
  }
}
