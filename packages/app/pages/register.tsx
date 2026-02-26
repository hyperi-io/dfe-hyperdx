import { redirect } from 'next/navigation';

import AuthPage from '@/AuthPage';
import { IS_DEV } from '@/theme';

// Force dynamic rendering so redirect() runs at request time, not build time
export const getServerSideProps = () => ({ props: {} });

export default function Register() {
  if (!IS_DEV) {
    return redirect('/404');
  }

  return (
    <div>
      {IS_DEV && (
        <div
          style={{
            width: '26rem',
            position: 'absolute',
            top: '95px',
            left: '20px',
            backgroundColor: 'red',
            color: 'white',
            fontSize: '1.5rem',
            fontWeight: 'bold',
            textAlign: 'center',
            padding: '1rem',
          }}
        >
          {' '}
          ONLY ENABLED IN DEV MODE
        </div>
      )}
      <AuthPage action="register" />
    </div>
  );
}
