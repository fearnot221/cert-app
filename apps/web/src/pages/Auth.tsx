import { useState, type FormEvent } from "react";
import { ArrowRightIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { post, resetCsrf } from "../lib/api";
import { useAction } from "../lib/hooks";
import { Alert } from "../components/common";
import { Button } from "../components/ui/button";

export function Auth({
  onAuthenticated,
  activationToken,
  resetToken,
}: {
  onAuthenticated: () => Promise<void>;
  activationToken?: string | null;
  resetToken?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const action = useAction();
  const [mode, setMode] = useState<
    "login" | "activation" | "reset" | "forgot-password" | "resend-activation"
  >(
    resetToken !== undefined
      ? "reset"
      : activationToken !== undefined
        ? "activation"
        : "login",
  );
  const [notice, setNotice] = useState("");
  const activating = mode === "activation" || mode === "reset";
  const requesting = mode === "forgot-password" || mode === "resend-activation";
  const token = mode === "reset" ? resetToken : activationToken;
  const changeMode = (next: typeof mode) => {
    setMode(next);
    setNotice("");
    setPassword("");
    setConfirmPassword("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      if (activating && password !== confirmPassword)
        throw new Error("兩次輸入的密碼不一致。");
      if (requesting) {
        await post(`/auth/${mode}`, { email });
        setNotice("若帳號符合條件，我們會寄送連結。請檢查信箱，稍候再申請。");
        return;
      }
      if (mode === "reset") {
        await post("/auth/reset-password", { token: resetToken, password });
        resetCsrf();
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        history.replaceState({}, "", "/");
        setNotice("密碼已更新，所有舊登入均已失效。請使用新密碼登入。");
        return;
      }
      if (activating)
        await post("/auth/activate", { token: activationToken, password });
      else await post("/auth/login", { email, password });
      resetCsrf();
      await onAuthenticated();
    });
  };
  return (
    <main className="auth-page">
      <section className="auth-brand" aria-label="Certfolio 證書工作室">
        <a className="wordmark" href="/">
          <span className="brand-mark">C</span>certfolio
          <span className="wordmark-divider">/</span>
          <span className="wordmark-sub">證書工作室</span>
        </a>
        <div className="auth-intro">
          <span className="eyebrow">每一份成就，都值得被留存</span>
          <h1>
            從完成學習，
            <br />
            到收下認可。
          </h1>
          <p>
            讓證書製作、發放與領取，
            <br />
            在同一個安心的工作空間完成。
          </p>
          <div className="auth-process">
            <span>設計模板</span>
            <span>批次發證</span>
            <span>安心領取</span>
          </div>
        </div>
        <p className="auth-footnote">
          組織工作空間與個人證書，共用一個登入帳號。
        </p>
      </section>
      <section className="auth-form-section">
        <div className="auth-form-wrap">
          <span className="auth-lock">
            <LockClosedIcon />
          </span>
          <h2>
            {mode === "reset"
              ? "重設密碼"
              : mode === "forgot-password"
                ? "忘記密碼"
                : mode === "resend-activation"
                  ? "重發啟用信"
                  : activating
                    ? "啟用你的帳號"
                    : "歡迎回來"}
          </h2>
          <p>
            {requesting
              ? "輸入你的帳號信箱，我們會寄送新的安全連結。"
              : mode === "reset"
                ? "設定新密碼後，請重新登入。"
                : activating
                  ? "設定密碼後，即可登入領取屬於你的證書。"
                  : "登入後，繼續你的工作或查看個人證書。"}
          </p>
          <form
            onSubmit={submit}
            className="form-stack"
            aria-busy={action.busy}
          >
            <Alert message={action.error} />
            <Alert message={notice} kind="info" />
            {activating && !token && (
              <Alert message="啟用連結缺少憑證，請使用最新通知信中的完整連結。" />
            )}
            {!activating && (
              <label>
                電子郵件
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@organization.org"
                />
              </label>
            )}
            {!requesting && (
              <label>
                {activating ? "設定密碼" : "密碼"}
                <input
                  type="password"
                  autoComplete={
                    activating ? "new-password" : "current-password"
                  }
                  minLength={activating ? 12 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-describedby={activating ? "password-help" : undefined}
                />
              </label>
            )}
            {activating && (
              <>
                <p className="field-help" id="password-help">
                  使用至少 12 個字元，建議使用獨特的長密碼。
                </p>
                <label>
                  再次輸入密碼
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </label>
              </>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={action.busy || (activating && !token)}
            >
              {action.busy
                ? "正在處理…"
                : requesting
                  ? "寄送連結"
                  : mode === "reset"
                    ? "儲存新密碼"
                    : activating
                      ? "啟用帳號並繼續"
                      : "登入工作空間"}
              <ArrowRightIcon />
            </Button>
          </form>
          <div className="button-row mt-4">
            {mode !== "forgot-password" && (
              <Button
                variant="ghost"
                onClick={() => changeMode("forgot-password")}
              >
                忘記密碼
              </Button>
            )}
            {mode !== "resend-activation" && (
              <Button
                variant="ghost"
                onClick={() => changeMode("resend-activation")}
              >
                重發啟用信
              </Button>
            )}
            {mode !== "login" && (
              <Button variant="ghost" onClick={() => changeMode("login")}>
                返回登入
              </Button>
            )}
          </div>
          <p className="auth-note">
            {activating
              ? "連結僅供本人使用，按下啟用後將立即失效。"
              : "首次領取證書？請開啟通知信中的帳號啟用連結。"}
          </p>
        </div>
      </section>
    </main>
  );
}
