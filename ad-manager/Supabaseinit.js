import supabase from "./supabaseClient.js";

export async function ensureBucket(name = "campaigns") {
  const { data: list, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error("listBuckets error:", listErr);
    return;
  }
  if (list?.some(b => b.name === name)) return;

  const { error: createErr } = await supabase.storage.createBucket(name, {
    public: false
  });
  if (createErr) console.error("createBucket error:", createErr);
  else console.log(`✅ Created storage bucket: ${name}`);
}
