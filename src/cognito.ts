// Cognito USER_PASSWORD_AUTH — no AWS SDK needed, plain HTTPS
const REGION = "us-east-2";
const CLIENT_ID = "8b8pm28a6k25pdlgbp6c8eq4e";
const ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`;

interface AuthResponse {
  AuthenticationResult?: {
    AccessToken: string;
    RefreshToken: string;
    ExpiresIn: number; // seconds
  };
  ChallengeName?: string;
  message?: string; // error from Cognito
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
}

async function cognitoPost(target: string, body: object): Promise<AuthResponse> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": target,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as AuthResponse;
  if (!res.ok) {
    throw new Error((data as any).__type?.replace(/^.*#/, "") + ": " + (data.message ?? res.statusText));
  }
  return data;
}

export async function loginWithPassword(username: string, password: string): Promise<AuthTokens> {
  const data = await cognitoPost("AWSCognitoIdentityProviderService.InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password,
    },
  });

  if (data.ChallengeName) {
    throw new Error(`Cognito challenge required: ${data.ChallengeName} (not supported — use 'fab auth <token>')`);
  }

  if (!data.AuthenticationResult) {
    throw new Error("No authentication result returned from Cognito");
  }

  return {
    accessToken: data.AuthenticationResult.AccessToken,
    refreshToken: data.AuthenticationResult.RefreshToken,
    expiresAt: Date.now() + data.AuthenticationResult.ExpiresIn * 1000,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const data = await cognitoPost("AWSCognitoIdentityProviderService.InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: CLIENT_ID,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  });

  if (!data.AuthenticationResult) {
    throw new Error("Token refresh failed — please run 'fab login' again");
  }

  return {
    accessToken: data.AuthenticationResult.AccessToken,
    // Cognito doesn't return a new refresh token on refresh, reuse the old one
    refreshToken,
    expiresAt: Date.now() + data.AuthenticationResult.ExpiresIn * 1000,
  };
}
