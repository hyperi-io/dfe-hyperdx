import AuthPage from '@/AuthPage';
import { IS_DEV } from '@/theme';

// Dev-only page (DFE users come from OIDC); DFE_LOCAL_AUTH_PAGES=true lets a
// deployment opt in until its OIDC wiring lands. Gate via getServerSideProps
// notFound: next/navigation redirect() is App-router-only and crashes the
// Pages router on both server render (500) and client navigation.
export const getServerSideProps = () => {
  if (!IS_DEV && process.env.DFE_LOCAL_AUTH_PAGES !== 'true') {
    return { notFound: true };
  }
  return { props: {} };
};

export default function Register() {
  return (
    <div>
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
      <AuthPage action="register" />
    </div>
  );
}
