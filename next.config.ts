import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  agentRules:false,
  async headers(){
    const identityOrigin=process.env.ADMIN_OIDC_ISSUER?new URL(process.env.ADMIN_OIDC_ISSUER).origin:'';
    const headers=[
      {key:'Cache-Control',value:'private, no-store, max-age=0'},
      {key:'Referrer-Policy',value:'no-referrer'},
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'X-Robots-Tag',value:'noindex, nofollow'},
      {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline'"+(process.env.NODE_ENV==='development'?" 'unsafe-eval'":'')+"; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self' https://checkout.stripe.com "+identityOrigin+"; base-uri 'none'"},
    ];
    return ['/manage/:path*','/admin/:path*','/api/access/:path*'].map(source=>({source,headers}));
  },
};
export default nextConfig;
