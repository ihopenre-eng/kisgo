import HomeClient from './home-client';

// 브라우저 카메라 앱이므로 GitHub Pages에서도 서버 없이 정적으로 제공한다.
export const dynamic = 'force-static';

export default function Home() {
  return <HomeClient />;
}
