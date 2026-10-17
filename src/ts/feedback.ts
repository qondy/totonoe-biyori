const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xwvjwann';

export async function submitFeedback(message: string): Promise<boolean> {
  try {
    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({ message, app: 'ととのえ日和' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
