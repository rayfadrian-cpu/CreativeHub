import CreativeHub from "./creative-hub";
import { chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) redirect("/login");
  return (
    <CreativeHub
      user={{ name: user.displayName, email: user.email }}
      signOutHref={chatGPTSignOutPath("/login")}
    />
  );
}
