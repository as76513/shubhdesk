import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import { Authenticator, ThemeProvider, type Theme } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import outputs from "../amplify_outputs.json";
import App from "./App";

Amplify.configure(outputs);

/**
 * ShubhDesk login gate.
 * `hideSignUp` means staff cannot self-register — only an admin creates
 * accounts in the Amplify console. The Authenticator handles login,
 * password reset, and session tokens; App reads the user's group to
 * decide their role.
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
      <Authenticator hideSignUp>
        {() => <App />}
      </Authenticator>
    </ThemeProvider>
  </React.StrictMode>
);
