import { getChatGPTUser, chatGPTSignInPath } from "../chatgpt-auth";
import { redirect } from "next/navigation";
import { Layers3, ArrowRight, LockKeyhole } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function Login() {
  if (await getChatGPTUser()) redirect("/");
  return <main className="login-screen"><div className="login-brand"><span className="brand-mark"><Layers3 size={22}/></span>Creative Hub</div><section className="login-card"><span className="eyebrow">YOUR CONTENT WORKSPACE</span><h1>Welcome back.</h1><p>Plan the next idea. Keep your team in sync.</p><a className="login-button" href={chatGPTSignInPath("/")} target="_top">Sign in with ChatGPT <ArrowRight size={18}/></a><div className="login-security"><LockKeyhole size={16}/><span>Secure sign-in. Access is limited to workspace members.</span></div></section><p className="login-footnote">One place for your ideas, plans, and approvals.</p></main>;
}
