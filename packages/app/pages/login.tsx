import { redirect } from 'next/navigation';

import AuthPage from '@/AuthPage';
import { IS_DEV } from '@/theme';

// Force dynamic rendering so redirect() runs at request time, not build time
export const getServerSideProps = () => ({ props: {} });

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
