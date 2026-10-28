// Solana Pay transfer request: https://docs.solanapay.com/spec
export function solanaPayUrl(recipient: string, amount: string, mint: string, reference: string, label?: string) {
  const params = new URLSearchParams({ amount, "spl-token": mint, reference });
  if (label) params.set("label", label);
  return `solana:${recipient}?${params}`;
}
