import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { post, resetCsrf } from "../../lib/api";
import { useAction } from "../../lib/hooks";
import { homePath, useSession } from "../../app/session";
import { Button } from "../../ui/Button";
import { Notice, Wordmark } from "../../ui/feedback";

type Mode = "login" | "activation" | "reset" | "forgot-password" | "resend-activation";

function readHashToken() {
  return location.hash ? new URLSearchParams(location.hash.slice(1)).get("token") : null;
}

const copy: Record<Mode, { title: string; description: string; submit: string }> = {
  login: { title: "歡迎回來", description: "登入後，繼續你的發證工作，或查看自己的證書。", submit: "登入工作空間" },
  activation: { title: "啟用你的帳號", description: "設定密碼後，就能登入領取屬於你的證書。", submit: "啟用帳號並繼續" },
  reset: { title: "重設密碼", description: "設定新密碼後，請重新登入。", submit: "儲存新密碼" },
  "forgot-password": { title: "忘記密碼", description: "輸入帳號信箱，我們會寄送新的安全連結。", submit: "寄送連結" },
  "resend-activation": { title: "重發啟用信", description: "輸入帳號信箱，我們會寄送新的啟用連結。", submit: "寄送連結" },
};

/** Sign in, activation, password reset and link requests share one page and one form. */
export function AuthPage({ mode: initialMode }: { mode: "login" | "activation" | "reset" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refresh, notice: sessionNotice, setNotice: setSessionNotice } = useSession();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [token, setToken] = useState<string | null>(() => (initialMode === "login" ? null : readHashToken()));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  const action = useAction();

  useEffect(() => {
    // Tokens travel in the fragment so they never reach server logs; drop them from the address bar.
    if (location.hash) history.replaceState(history.state, "", location.pathname);
    const receive = () => {
      const next = readHashToken();
      if (!next) return;
      setToken(next);
      setMode(initialMode);
      setNotice("");
      setPassword("");
      setConfirmPassword("");
      history.replaceState(history.state, "", location.pathname);
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, [initialMode]);

  const settingPassword = mode === "activation" || mode === "reset";
  const requesting = mode === "forgot-password" || mode === "resend-activation";
  const shownNotice = notice || (mode === "login" ? sessionNotice : "");

  const changeMode = (next: Mode) => {
    setMode(next);
    setNotice("");
    setSessionNotice("");
    setPassword("");
    setConfirmPassword("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      if (settingPassword && password !== confirmPassword) throw new Error("兩次輸入的密碼不一致。");
      if (requesting) {
        await post(`/auth/${mode}`, { email });
        setNotice("若帳號符合條件，我們會寄送連結。請檢查信箱，稍候再申請。");
        return;
      }
      if (mode === "reset") {
        await post("/auth/reset-password", { token, password });
        resetCsrf();
        setSessionNotice("密碼已更新，所有舊登入均已失效。請使用新密碼登入。");
        setPassword("");
        setConfirmPassword("");
        await refresh();
        if (initialMode === "login") setMode("login");
        else navigate("/login", { replace: true });
        return;
      }
      if (mode === "activation") await post("/auth/activate", { token, password });
      else await post("/auth/login", { email, password });
      resetCsrf();
      setSessionNotice("");
      const session = await refresh();
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      navigate(mode === "activation" ? "/me" : (safeNext ?? homePath(session)), { replace: true });
    });
  };

  const text = copy[mode];
  return (
    <main className="auth">
      <section className="auth-field" aria-label="certfolio">
        <Wordmark />
        <div className="auth-seals" aria-hidden>
          <span className="seal seal-issue" />
          <span className="seal seal-verify" />
        </div>
        <div className="auth-statement">
          <p className="auth-headline">組織發證，個人領取，共用一個帳號。</p>
          <p>
            還沒有帳號？通知信裡附有一次性的啟用連結。想確認一張證書的真偽，
            <Link to="/#verify">不必登入也能查詢</Link>。
          </p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <h1>{text.title}</h1>
          <p className="auth-lead">{text.description}</p>
          <form onSubmit={submit} className="stack" aria-busy={action.busy}>
            <Notice message={action.error} />
            <Notice message={shownNotice} kind="info" />
            {settingPassword && !token && <Notice message="連結缺少憑證，請使用最新通知信中的完整連結。" />}
            {!settingPassword && (
              <label className="field">
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
              <div className="field">
                <label htmlFor="auth-password">{settingPassword ? "設定密碼" : "密碼"}</label>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={settingPassword ? "new-password" : "current-password"}
                  minLength={settingPassword ? 12 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-describedby={settingPassword ? "password-help" : undefined}
                />
                {settingPassword && (
                  <span className="field-help" id="password-help">
                    至少 12 個字元，建議使用獨特的長密碼。
                  </span>
                )}
              </div>
            )}
            {settingPassword && (
              <label className="field">
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
            )}
            <Button type="submit" className="btn-block" disabled={action.busy || (settingPassword && !token)}>
              {action.busy ? "正在處理…" : text.submit}
              <ArrowRightIcon />
            </Button>
          </form>
          <div className="auth-switch">
            {mode !== "forgot-password" && (
              <Button variant="ghost" size="sm" onClick={() => changeMode("forgot-password")}>
                忘記密碼
              </Button>
            )}
            {mode !== "resend-activation" && (
              <Button variant="ghost" size="sm" onClick={() => changeMode("resend-activation")}>
                重發啟用信
              </Button>
            )}
            {mode !== "login" && (
              <Button variant="ghost" size="sm" onClick={() => changeMode("login")}>
                返回登入
              </Button>
            )}
          </div>
          <p className="field-help">
            {settingPassword ? "連結僅供本人使用，完成設定後立即失效。" : "第一次領取證書？請開啟通知信中的帳號啟用連結。"}
          </p>
        </div>
      </section>
    </main>
  );
}
