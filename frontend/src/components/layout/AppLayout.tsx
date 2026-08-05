import { Outlet } from 'react-router-dom';
import { ToastContainer } from '../ui/ToastContainer';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

/**
 * AppLayout
 * =========
 * 認証後の全画面に共通するシェル。サイドバー(ナビゲーション)+ヘッダー
 * (テナント切替・ユーザー情報)+メインコンテンツ領域(`<Outlet />`)で構成する。
 *
 * `src/App.tsx` のルーティング定義で、このコンポーネントを親ルートの
 * `element` に指定し、子ルートを `<Outlet />` にレンダリングする。
 */
export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-950 text-surface-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <Outlet />
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
