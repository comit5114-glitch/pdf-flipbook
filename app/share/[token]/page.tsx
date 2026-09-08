import Home from '../../page';

export default async function SharedBookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Home sharedToken={token} />;
}
