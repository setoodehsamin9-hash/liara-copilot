export function ErrorNotice({ message, guidance }: { message: string; guidance: string }) {
  return <div className="error-message" role="alert">
    <strong>این بخش کامل نشد.</strong>
    <p>{guidance}</p>
    <details><summary>جزئیات فنی</summary><span dir="auto">{message}</span></details>
  </div>;
}
