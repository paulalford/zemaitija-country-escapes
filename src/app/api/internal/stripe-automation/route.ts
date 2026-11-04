import { AutomationError, authorizeStripeAutomation, stripeAutomationConfig,
  validateAutomationRequest } from '@/server/stripe-automation-config';
import { runStripeAutomationFoundation } from '@/server/stripe-automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unavailable(code: string, status: number): Response {
  return Response.json({ status: 'UNAVAILABLE', code }, {
    status, headers: { 'Cache-Control': 'no-store', ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const config = stripeAutomationConfig(process.env);
    authorizeStripeAutomation(request.headers.get('authorization'), config);
    validateAutomationRequest(request);
    // No DB client, gateway, or financial processor is imported or constructed here.
    const result = runStripeAutomationFoundation(config);
    return unavailable(result.reason, 503);
  } catch (error) {
    if (error instanceof AutomationError) {
      if (error.code === 'UNAUTHORIZED') return unavailable('UNAUTHORIZED', 401);
      if (error.code === 'REQUEST_PARAMETERS') return unavailable('REQUEST_PARAMETERS', 400);
      if (error.code === 'DISABLED') return unavailable('DISABLED', 503);
    }
    return unavailable('UNAVAILABLE', 503);
  }
}
