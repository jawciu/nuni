"use client";
import dynamic from "next/dynamic";
import { ChatPanel } from "@/components/ChatPanel";

// three needs a browser, and the canvas is the whole right-hand side
const Viewer = dynamic(() => import("@/components/Viewer").then((m) => m.Viewer), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#0e0d0c]" />,
});

export default function Home() {
  return (
    <main className="grid h-dvh w-screen grid-rows-[1fr_auto] md:grid-cols-[360px_1fr] md:grid-rows-1">
      <div className="order-2 min-h-0 md:order-1">
        <ChatPanel />
      </div>
      <div className="order-1 min-h-0 md:order-2">
        <Viewer />
      </div>
    </main>
  );
}
