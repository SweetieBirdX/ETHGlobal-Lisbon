import Hero from './components/Hero';
import Problem from './components/Problem';
import HowItWorks from './components/HowItWorks';
import LiveNumbers from './components/LiveNumbers';
import Reusable from './components/Reusable';
import Architecture from './components/Architecture';
import Technology from './components/Technology';
import VerifyIndependently from './components/VerifyIndependently';
import Footer from './components/Footer';

function App() {
  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <LiveNumbers />
      <Reusable />
      {/* Architecture predates this ordering and still carries the on-chain vs
          off-chain split, so it sits between the reuse argument and the badges. */}
      <Architecture />
      <Technology />
      <VerifyIndependently />
      <Footer />
    </>
  );
}

export default App;
