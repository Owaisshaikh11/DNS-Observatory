import { useState } from 'react';
import InteractiveGrid from '../components/InteractiveGrid';
import BrutalistSelect from '../components/BrutalistSelect';
import BentoBox from '../components/BentoBox';
import FlagBadge from '../components/FlagBadge';
import { Terminal, Activity, Layers, ShieldCheck } from 'lucide-react';

export default function EntryPage() {
  const [selectedRecord, setSelectedRecord] = useState('A');
  const [selectedResolver, setSelectedResolver] = useState('local');

  const recordOptions = [
    { value: 'A', label: 'A (IPv4 Address)' },
    { value: 'AAAA', label: 'AAAA (IPv6 Address)' },
    { value: 'CNAME', label: 'CNAME (Canonical Name)' },
    { value: 'MX', label: 'MX (Mail Exchange)' },
    { value: 'TXT', label: 'TXT (Text Record)' },
    { value: 'NS', label: 'NS (Name Server)' },
    { value: 'SOA', label: 'SOA (Start of Authority)' },
    { value: 'ALL', label: 'ALL Records (Iterative)' }
  ];

  const resolverOptions = [
    { value: 'local', label: 'Observatory Local (UDP 5354)' },
    { value: 'root', label: 'Direct Iterative Resolution' }
  ];

  return (
    <InteractiveGrid>
      <div className="min-h-screen flex flex-col justify-between p-6 md:p-12 font-sans select-none">
        {/* Header HUD */}
        <header className="flex justify-between items-center border-b-2 border-[#0D0D0D] pb-4 font-mono">
          <div className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 bg-[#FF4D00] animate-pulse rounded-none" />
            <h1 className="text-xl font-bold tracking-tight uppercase">DNS_OBSERVATORY v1.0.0</h1>
          </div>
          <div className="hidden md:flex gap-6 text-[10px] uppercase font-bold tracking-wider">
            <span>Status: <span className="text-[#22C55E]">ONLINE</span></span>
            <span>DNS Server: <span className="text-[#FF4D00]">PORT 5354</span></span>
            <span>API: <span className="text-[#FF4D00]">PORT 4000</span></span>
          </div>
        </header>

        {/* Main Interface Test Box */}
        <main className="my-12 max-w-4xl mx-auto w-full">
          <div className="bg-white border-2 border-[#0D0D0D] p-8 md:p-12 shadow-[8px_8px_0_0_#0D0D0D] relative mb-12">
            <div className="absolute top-0 right-0 bg-[#FF4D00] text-white px-3 py-1 font-mono text-[10px] font-bold uppercase border-b-2 border-l-2 border-[#0D0D0D]">
              COMPONENT_SHOWCASE
            </div>

            <h2 className="font-display text-3xl md:text-5xl font-extrabold uppercase mb-4 tracking-tight leading-none">
              UI FOUNDATION VERIFICATION
            </h2>
            <p className="font-mono text-sm opacity-70 mb-8 max-w-2xl">
              Testing Brutalist design system tokens, CSS variables, Interactive grid layout, Custom cursor transitions, and React state stores.
            </p>

            {/* Test Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <BrutalistSelect
                label="SELECT RECORD TYPE"
                options={recordOptions}
                value={selectedRecord}
                onChange={setSelectedRecord}
              />
              <BrutalistSelect
                label="SELECT RESOLVER METHOD"
                options={resolverOptions}
                value={selectedResolver}
                onChange={setSelectedResolver}
              />
            </div>

            {/* Flags Testing */}
            <div className="border-t-2 border-[#0D0D0D]/10 pt-6">
              <div className="text-[10px] text-[#0D0D0D] opacity-50 uppercase tracking-widest mb-3 font-mono">
                HOVER TO TEST FLAGS TOOLTIPS (FLAGBADGE)
              </div>
              <div className="flex flex-wrap gap-2">
                <FlagBadge flag="QR" />
                <FlagBadge flag="AA" />
                <FlagBadge flag="RD" />
                <FlagBadge flag="RA" />
                <FlagBadge flag="TC" />
              </div>
            </div>
          </div>

          {/* Bento Grid Info Box */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <BentoBox
              title="Iterative Tracer"
              description="Hop-by-hop resolution tracking from root servers down to the authoritative nameserver with real-time geographical lookup."
              icon={<Layers className="w-8 h-8" />}
              delay={0.1}
            />
            <BentoBox
              title="Live Telemetry"
              description="Monitor incoming queries processed by the local DNS daemon. Streamed instantaneously via Socket.io websocket events."
              icon={<Activity className="w-8 h-8" />}
              delay={0.2}
            />
            <BentoBox
              title="DNSSEC Verification"
              description="Detailed auditing of cryptographic markers including RRSIG validation, DS record presence, and DNSKEY trust chains."
              icon={<ShieldCheck className="w-8 h-8" />}
              delay={0.3}
            />
          </div>
        </main>

        {/* Footer HUD */}
        <footer className="flex flex-col md:flex-row justify-between items-center border-t-2 border-[#0D0D0D] pt-4 font-mono text-[10px] tracking-wide uppercase">
          <div className="flex items-center gap-2 mb-2 md:mb-0">
            <Terminal className="w-3.5 h-3.5" />
            <span>DESIGN SYSTEM: FUNCTIONAL BRUTALIST</span>
          </div>
          <div className="opacity-60">
            SECURE DNS OBSERVATORY LABORATORY // ALL HOPS MAPPED
          </div>
        </footer>
      </div>
    </InteractiveGrid>
  );
}
