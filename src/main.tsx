import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import {
  signIn,
  resetPassword,
  confirmResetPassword,
  type SignInInput,
  type ResetPasswordInput,
  type ConfirmResetPasswordInput,
} from "aws-amplify/auth";
import { Authenticator, ThemeProvider, type Theme } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import outputs from "../amplify_outputs.json";
import App from "./App";

Amplify.configure(outputs);

const LOGIN_DOMAIN = "shubhshreeknowledgehub.com";

/** Staff type `amol.shinde`; Cognito still gets the full email. A full email is left as-is. */
function toCognitoEmail(username: string): string {
  const raw = username.trim().toLowerCase();
  if (!raw || raw.includes("@")) return raw;
  return `${raw}@${LOGIN_DOMAIN}`;
}

const authServices = {
  async handleSignIn(input: SignInInput) {
    return signIn({ ...input, username: toCognitoEmail(input.username ?? "") });
  },
  async handleForgotPassword(input: ResetPasswordInput) {
    return resetPassword({ ...input, username: toCognitoEmail(input.username) });
  },
  async handleForgotPasswordSubmit(input: ConfirmResetPasswordInput) {
    return confirmResetPassword({ ...input, username: toCognitoEmail(input.username) });
  },
};

const usernameField = {
  label: "Username",
  placeholder: "amol.shinde",
  // Pool is email-login, so Authenticator defaults this to type=email and
  // the browser refuses `amol.shinde` before handleSignIn can append the domain.
  type: "text" as const,
  autocomplete: "username",
};

const formFields = {
  signIn: { username: usernameField },
  forgotPassword: { username: usernameField },
};

/**
 * ShubhDesk login gate.
 * `hideSignUp` means staff cannot self-register — only an admin creates
 * accounts in the Amplify console. Login accepts the email local part
 * (`amol.shinde`); Cognito still receives the full work email. The
 * Authenticator handles login, password reset, and session tokens;
 * App reads the user's group to decide their role.
 */
const theme: Theme = {
  name: "shubhdesk",
  tokens: {
    colors: {
      brand: {
        primary: {
          10: "#F0E9D6",
          80: "#E0AA3D",
          90: "#C9902A",
          100: "#07163F",
        },
      },
    },
    components: {
      button: {
        primary: {
          backgroundColor: "#E0AA3D",
          color: "#07163F",
          _hover: { backgroundColor: "#C9902A", color: "#07163F" },
        },
      },
    },
  },
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <Authenticator hideSignUp services={authServices} formFields={formFields}>
        {() => <App />}
      </Authenticator>
    </ThemeProvider>
  </React.StrictMode>
);
