/** Explicit Node 24 host-tool hook only. No environment/filesystem/database reads.
 * Resolve repository-relative extensionless TypeScript imports; packages retain
 * normal Node resolution and the caller supplies --conditions=react-server. */
import { registerHooks } from 'node:module';
const root=new URL('../../',import.meta.url).href;
const sourceRoots=['scripts/','src/','tests/'].map(path=>new URL(path,root).href);
function approvedSource(url) {
  try {
    const parsed=new URL(url);
    return sourceRoots.some(source=>parsed.href.startsWith(source)) &&
      /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(parsed.pathname) &&
      !decodeURIComponent(parsed.pathname).split('/').includes('node_modules');
  } catch {return false;}
}
registerHooks({resolve(specifier,context,nextResolve) {
  if(approvedSource(context.parentURL) && /^\.{1,2}\//.test(specifier) &&
      !/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(specifier)) {
    const url=new URL(`${specifier}.ts`,context.parentURL);
    if(!url.href.startsWith(root))throw Error('HOST_TOOL_IMPORT_OUTSIDE_REPOSITORY');
    if(!approvedSource(url.href))return nextResolve(specifier,context);
    return nextResolve(url.href,context);
  }
  return nextResolve(specifier,context);
}});
