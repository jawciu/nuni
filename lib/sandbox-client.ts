"use client";

const KEY = "nuni.sandbox";

type Warm = { id: string; url: string | null };

async function call(body: Record<string, unknown>) {
  const r = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

/**
 * Warms one GPU sandbox and keeps it. Installing the model stack takes minutes, so it happens
 * once, in the background, while the person is still choosing what they want. Every cut-out
 * after that lands on a box with the weights already resident.
 */
export async function warmSandbox(onStep: (s: string) => void): Promise<Warm | null> {
  let id = localStorage.getItem(KEY);

  if (id) {
    const s = await call({ action: "status", id });
    if (s.ready) return { id, url: s.url };
    if (s.error) id = null;
  }

  if (!id) {
    onStep("claiming a gpu");
    const c = await call({ action: "create" });
    if (c.error) {
      onStep(`sandbox failed: ${c.error}`);
      return null;
    }
    id = c.id as string;
    localStorage.setItem(KEY, id);
    onStep("installing the cut-out models");
    const i = await call({ action: "install", id });
    if (i.error) {
      onStep(`install failed: ${i.error}`);
      return null;
    }
  }

  const labels: Record<string, string> = {
    starting: "booting the sandbox",
    apt: "installing system packages",
    pip: "installing the model stack",
    weights: "pulling the segmentation weights",
    serve: "starting the isolation server",
    done: "warming the model",
  };

  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const s = await call({ action: "status", id });
    if (s.ready) return { id, url: s.url };
    onStep(labels[s.step] ?? s.step ?? "warming up");
    await new Promise((r) => setTimeout(r, 4000));
  }
  onStep("sandbox took too long");
  return null;
}

export function forgetSandbox() {
  localStorage.removeItem(KEY);
}
