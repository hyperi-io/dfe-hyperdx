import { redirect } from 'next/navigation';

import AuthPage from '@/AuthPage';
import { IS_DEV } from '@/theme';

export default function Login() {
  if (!IS_DEV) {
    return redirect('/404');
  }
  return (
    <div>
      <AuthPage action="login" />
    </div>
  );
}
