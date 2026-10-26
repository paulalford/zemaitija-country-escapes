export default function SignIn(){
  const configured=!!(process.env.ADMIN_OIDC_ISSUER&&process.env.ADMIN_OIDC_CLIENT_ID&&process.env.ADMIN_OIDC_CLIENT_SECRET&&process.env.ADMIN_OIDC_MFA_ACR&&process.env.ACCESS_SECRET&&process.env.APP_ORIGIN);
  return <div className="access-panel"><h1>Operator sign in</h1><p>Use your individually assigned administrator identity. Fresh multifactor authentication is required; access follows your current role and accommodation permissions.</p>
    {configured?<form action="/api/access/admin/login" method="post"><button>Sign in with your identity provider</button></form>:<p className="notice">Administrator sign-in is not configured for this environment. The operator must complete identity-provider setup before access is available.</p>}
    <p className="muted">No public or shared demonstration credentials are provided.</p></div>;
}
