import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0a1a0f 0%, #0d2418 40%, #0a1a0f 100%)' }}
    >
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-[-10%] right-[-5%] w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #4ade80 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-[-5%] left-[-5%] w-80 h-80 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #d4a520 0%, transparent 70%)' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-sm mx-4"
      >
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 text-white text-2xl font-semibold"
            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)', boxShadow: '0 8px 32px rgba(22,163,74,0.35)' }}
          >
            AL
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#e8f5ee', fontFamily: 'Georgia, serif' }}>
            AyurLedger
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b9e7a' }}>
            Premium Business Suite
          </p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 32px 64px rgba(0,0,0,0.4)',
          }}
        >
          <h2 className="text-lg font-semibold mb-6" style={{ color: '#d1fae5' }}>
            Sign in to your account
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#6b9e7a' }}>
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={isLoading}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200 disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e8f5ee' }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#6b9e7a' }}>
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-200 disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e8f5ee' }}
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl px-4 py-3 text-sm"
                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={isLoading || !username || !password}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: isLoading ? 'rgba(22,163,74,0.5)' : 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff',
                boxShadow: isLoading ? 'none' : '0 4px 20px rgba(22,163,74,0.35)',
              }}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
