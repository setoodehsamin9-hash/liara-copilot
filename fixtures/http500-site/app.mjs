// LOCAL TEST WEBSITE ONLY. Missing name causes a reproducible HTTP 500.
export function respond(url) {
  try {
    const name = new URL(url).searchParams.get('name').trim();
    return { status: 200, body: `سلام ${name || 'دوست'}` };
  } catch {
    return { status: 500, body: 'خطای داخلی وب‌سایت آزمایشی' };
  }
}
