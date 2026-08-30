import Reader from "@/components/Reader";

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ch?: string; p?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const bookId = Number(id);
  const ch = Number(sp.ch ?? 0);
  const p = Number(sp.p ?? 0);

  return (
    <Reader
      bookId={bookId}
      initialCh={Number.isFinite(ch) && ch >= 0 ? ch : 0}
      initialPara={Number.isFinite(p) && p >= 0 ? p : 0}
    />
  );
}
