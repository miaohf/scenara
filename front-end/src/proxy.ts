import { NextRequest, NextResponse } from 'next/server';

const redirectEnabled = () => {
  const value = String(process.env.MEDIA_NGINX_REDIRECT ?? '').toLowerCase();
  return value === '1' || value === 'true';
};

/**
 * 仍从 :3000 打开页面时，把媒体请求 307 到 nginx，避免 Next rewrite 代传大文件。
 * 走 nginx :3080 入口时不会进到这里。
 */
export function proxy(request: NextRequest) {
  if (!redirectEnabled()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (!pathname.startsWith('/api/v1/media/raw/')) {
    return NextResponse.next();
  }

  const hostname = request.headers.get('host')?.split(':')[0] || '127.0.0.1';
  const port = process.env.MEDIA_NGINX_PORT || '3080';
  const proto = request.nextUrl.protocol.replace(':', '') || 'http';
  return NextResponse.redirect(`${proto}://${hostname}:${port}${pathname}${search}`, 307);
}

export const config = {
  matcher: '/api/v1/media/raw/:path*',
};
