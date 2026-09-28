/** Where to cancel well-known subscriptions. Opens in Safari; nothing is sent from the app. */
const LINKS: [RegExp, string][] = [
  [/netflix/i, 'https://www.netflix.com/cancelplan'],
  [/spotify/i, 'https://www.spotify.com/account/subscription/'],
  [/hulu/i, 'https://secure.hulu.com/account'],
  [/disney/i, 'https://www.disneyplus.com/account/subscription'],
  [/\bmax\b|hbo/i, 'https://auth.max.com/subscription'],
  [/youtube/i, 'https://www.youtube.com/paid_memberships'],
  [/peacock/i, 'https://www.peacocktv.com/account'],
  [/paramount/i, 'https://www.paramountplus.com/account/'],
  [/apple|itunes|icloud/i, 'https://apps.apple.com/account/subscriptions'],
  [/prime|amazon/i, 'https://www.amazon.com/mc'],
  [/audible/i, 'https://www.audible.com/account/overview'],
  [/adobe/i, 'https://account.adobe.com/plans'],
  [/dropbox/i, 'https://www.dropbox.com/account/plan'],
  [/nytimes|new york times/i, 'https://myaccount.nytimes.com/seg/subscription'],
  [/openai|chatgpt/i, 'https://chatgpt.com/#settings/Subscription'],
  [/claude|anthropic/i, 'https://claude.ai/settings/billing'],
  [/patreon/i, 'https://www.patreon.com/settings/memberships'],
  [/google|youtube tv/i, 'https://play.google.com/store/account/subscriptions'],
  [/sirius/i, 'https://care.siriusxm.com/'],
  [/microsoft|xbox/i, 'https://account.microsoft.com/services'],
  [/playstation/i, 'https://www.playstation.com/acct/management'],
];

export function cancelLinkFor(name: string, match = ''): string | undefined {
  const text = `${name} ${match}`;
  return LINKS.find(([re]) => re.test(text))?.[1];
}
