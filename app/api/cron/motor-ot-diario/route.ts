import { runMotorOtDiario } from "@/lib/motor/motor-ot-diario";

export const dynamic = "force-dynamic";

function autorizado(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const h = request.headers.get("authorization") ?? request.headers.get("Authorization");
  return h === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await runMotorOtDiario();
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
