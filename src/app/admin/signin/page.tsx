import { getPresentation } from '@/i18n/server';
export default async function SignIn(){
  const {t}=await getPresentation();

  const configured=!!(process.env.ADMIN_OIDC_ISSUER&&process.env.ADMIN_OIDC_CLIENT_ID&&process.env.ADMIN_OIDC_CLIENT_SECRET&&process.env.ADMIN_OIDC_MFA_ACR&&process.env.ACCESS_SECRET&&process.env.APP_ORIGIN);
  return <div className="access-panel"><h1>{t("Operator sign in")}</h1><p>{t("Use your individually assigned administrator identity. Fresh multifactor authentication is required; access follows your current role and accommodation permissions.")}</p>
    {configured?<form action="/api/access/admin/login" method="post"><button>{t("Sign in with your identity provider")}</button></form>:<p className="notice">{t("Administrator sign-in is not configured for this environment. The operator must complete identity-provider setup before access is available.")}</p>}
    <p className="muted">{t("No public or shared demonstration credentials are provided.")}</p></div>;
}
