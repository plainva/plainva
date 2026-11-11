import React from "react";
import i18n from "@plainva/ui/i18n";
import { describeAreaError, logDiagnostic } from "@plainva/ui";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // The last net, behind the boundaries of every area (stability plan R3).
    logDiagnostic("area:window", describeAreaError(error, errorInfo.componentStack));
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", background: "var(--bg-primary)", color: "var(--text-main)", height: "100%", overflow: "auto" }}>
          <h1>{i18n.t("errors.somethingWentWrong")}</h1>
          <pre>{this.state.error?.toString()}</pre>
          <pre style={{ fontSize: "var(--text-ui)", whiteSpace: "pre-wrap" }}>
            {this.state.errorInfo?.componentStack}
          </pre>
          <button onClick={() => window.location.reload()}>{i18n.t("errors.reload")}</button>
        </div>
      );
    }

    return this.props.children;
  }
}
