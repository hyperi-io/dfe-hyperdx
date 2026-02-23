const dfeUiBaseUrl = process.env.NEXT_PUBLIC_DFE_UI_BASE_URL ?? '';

const devLogout = () => {
  // For local development, we can just clear the localStorage
  // This is required for development purposes only
  localStorage.removeItem('accessToken');
  window.location.href = `${dfeUiBaseUrl}/login`;
};

const productionLogout = () => {
  // For production we will need to make a request to the backend to sign out
  // We still need to add an endpoint for this
  // apiClient.post('/api/v1/session/sign_out');
};

export const logout = () => {
  if (process.env.NODE_ENV === 'development') {
    devLogout();
  } else {
    productionLogout();
  }
};

export const useLogout = () => {
  const handleLogout = () => {
    logout();
  };
  return { handleLogout };
};
