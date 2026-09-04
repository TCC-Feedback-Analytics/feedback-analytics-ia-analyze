import { Router } from 'express';
import { analyzeController, synthesizeInsightsController } from '../controllers/iaAnalyze.controller.js';

const router = Router();

router.get('/health', (_req, res) => {
  return res.status(200).json({ ok: true, service: 'ia-analyze' });
});

router.get('/ia-analyze/health', (_req, res) => {
  return res.status(200).json({ ok: true, service: 'ia-analyze' });
});

router.post('/ia-analyze/analyze', analyzeController);
router.post('/ia-analyze/synthesize-insights', synthesizeInsightsController);

export default router;
