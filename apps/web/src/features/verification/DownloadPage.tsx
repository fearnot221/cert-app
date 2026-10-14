import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { DownloadIcon } from "@radix-ui/react-icons";
import { request } from "../../lib/api";
import { saveBlob } from "../../lib/download";
import { useAction } from "../../lib/hooks";
import { Button } from "../../ui/Button";
import { Notice, Wordmark } from "../../ui/feedback";

/** Recipients download their PDF with the serial and password from the notification email. No account. */
export function DownloadPage() {
  const [params] = useSearchParams();
  const [serial, setSerial] = useState(params.get("serial") ?? "");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState("");
  const action = useAction();
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "下載證書 · certfolio";
    return () => {
      document.title = previousTitle;
    };
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      setDone("");
      const response = await request("/public/certificates/download", {
        method: "POST",
        body: JSON.stringify({ serial, password }),
      });
      const name = serial.trim().replace(/[\\/<>:"|?*]/g, "_");
      saveBlob(await response.blob(), `${name}.pdf`);
      setDone(serial.trim());
    });
  };
  const tone = done ? "valid" : action.error ? "void" : "issue";
  return (
    <main className={`verify verify-${tone}`}>
      <header className="verify-bar">
        <Wordmark />
        <Link to="/verify" className="text-link">
          查詢流水號
        </Link>
      </header>
      <section className="verify-result">
        <div key={tone} className="verify-seal" aria-hidden>
          <span />
        </div>
        <div className="verify-copy">
          <h1>{done ? "證書已開始下載" : "下載你的證書"}</h1>
          <p className="verify-lead">
            {done
              ? `流水號 ${done} 的 PDF 已存到你的下載資料夾。之後隨時可以用同一組流水號與密碼再次下載。`
              : "輸入通知信中的證書流水號與下載密碼，不需要註冊或登入。"}
          </p>
        </div>
      </section>
      <section className="verify-record download-form" aria-label="輸入流水號與密碼">
        <form className="stack" onSubmit={submit}>
          <div className="download-fields">
            <label className="field">
              證書流水號
              <input
                name="serial"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                autoComplete="username"
                spellCheck={false}
                required
                maxLength={64}
                disabled={action.busy}
              />
            </label>
            <label className="field">
              下載密碼
              <input
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="XXXX-XXXX-XXXX"
                spellCheck={false}
                required
                maxLength={64}
                disabled={action.busy}
              />
            </label>
          </div>
          <Notice message={action.error} />
          <div className="btn-row">
            <Button type="submit" disabled={action.busy || !serial.trim() || !password.trim()}>
              <DownloadIcon />
              {action.busy ? "確認中…" : done ? "再次下載 PDF" : "下載 PDF"}
            </Button>
          </div>
        </form>
      </section>
      <p className="verify-disclaimer">
        密碼不分大小寫，連字號可以省略。同一個流水號連續輸入錯誤 10 次，會暫停下載 15 分鐘。找不到通知信或證書資料有誤，請聯絡發證單位。
        <Link to="/">認識 certfolio</Link>
      </p>
    </main>
  );
}
