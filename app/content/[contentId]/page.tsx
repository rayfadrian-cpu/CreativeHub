import CreativeHub from "../../creative-hub";
import { chatGPTSignOutPath, requireChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function ContentDetailPage({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params;
  const id = Number(contentId);
  const returnTo = Number.isInteger(id) && id > 0 ? `/content/${id}` : "/";
  const user = await requireChatGPTUser(returnTo);
  return <CreativeHub user={{ name: user.displayName, email: user.email }} signOutHref={chatGPTSignOutPath("/login")} initialContentId={Number.isInteger(id) && id > 0 ? id : null}/>;
}
