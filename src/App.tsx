import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import { accountLogin, accountStatus } from './api/ipc';
import Home from './pages/Home';
import Timeline from './pages/Timeline';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Todos from './pages/Todos';
import TodayOverview from './pages/TodayOverview';
import HeatMap from './pages/HeatMap';
import AppUsage from './pages/AppUsage';
import Plan from './pages/Plan';
import PlanMaster from './pages/PlanMaster';
import HistoryReports from './pages/HistoryReports';
import { ToastProvider } from './hooks/useToast';

export default function App() {
  // 本地账号登录门：启用后启动需输入密码解锁（会话内记忆，不落盘）
  const [gate, setGate] = useState<'checking' | 'locked' | 'open'>('checking');
  const [password, setPassword] = useState('');
  const [gateError, setGateError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    void accountStatus().then((st) => {
      setGate(st.enabled && st.has_account ? 'locked' : 'open');
    }).catch(() => setGate('open'));
  }, []);

  const tryUnlock = async () => {
    if (!password || unlocking) return;
    setUnlocking(true);
    setGateError('');
    try {
      const ok = await accountLogin(password);
      if (ok) {
        setGate('open');
        setPassword('');
      } else {
        setGateError('密码不正确');
      }
    } catch (e: any) {
      setGateError(String(e));
    } finally {
      setUnlocking(false);
    }
  };

  if (gate === 'locked') {
    return (
      <div className="h-screen w-screen flex flex-col bg-bg">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-[340px] bg-card border border-border rounded-lg shadow-lg p-6 space-y-4">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
                <Lock size={22} />
              </div>
              <div className="text-base font-semibold text-ink">日报助手已锁定</div>
              <div className="text-xs text-ink2">输入密码解锁本地数据</div>
            </div>
            <input
              type="password"
              autoFocus
              className="input-base w-full"
              placeholder="密码"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setGateError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && void tryUnlock()}
            />
            {gateError && <div className="text-xs text-red-500">{gateError}</div>}
            <button
              onClick={() => void tryUnlock()}
              disabled={!password || unlocking}
              className="w-full py-2 rounded-pix bg-primary text-white text-sm font-medium hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {unlocking ? '解锁中...' : '解锁'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg">
        <TitleBar />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-bg">
            <RoutesWithFade />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}

/** 路由切换时整页 fade-in */
function RoutesWithFade() {
  const loc = useLocation();
  return (
    <div key={loc.pathname} className="animate-fadein h-full">
      <Routes location={loc}>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/today" element={<TodayOverview />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/plan-master" element={<PlanMaster />} />
        <Route path="/history-reports" element={<HistoryReports />} />
        <Route path="/heatmap" element={<HeatMap />} />
        <Route path="/appusage" element={<AppUsage />} />
        <Route path="/todos" element={<Todos />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </div>
  );
}
