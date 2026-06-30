import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, Info, ChevronRight } from 'lucide-react';
import { accordionVariants } from '../constants/animations';

// Decode RCODE helper
const getRcodeDescription = (rcodeNum, name) => {
  const rcodes = {
    0: 'No error (0)',
    1: 'Format error (1)',
    2: 'Server failure (2)',
    3: 'Non-existent domain (3)',
    4: 'Not implemented (4)',
    5: 'Query refused (5)'
  };
  return rcodes[rcodeNum] || `${name} (${rcodeNum})`;
};

// Opcode descriptions
const getOpcodeDescription = (opcodeNum) => {
  const opcodes = {
    0: 'Standard query (0)',
    1: 'Inverse query (1)',
    2: 'Server status request (2)',
    4: 'Notify (4)',
    5: 'Update (5)'
  };
  return opcodes[opcodeNum] || `Unknown (${opcodeNum})`;
};

// DNSSEC algorithms helper
const getAlgorithmDescription = (algNum, name) => {
  return `${name} (${algNum})`;
};

const DEFAULT_TIMESTAMP = Date.now();

function DnsDissectorTree({
  packet,
  timestamp,
  ip,
  port,
  tab,
  resolvedOverTcp,
  isTimeout,
  openNodes,
  toggleNode,
  hoverBytes
}) {
  if (isTimeout && tab === 'RESPONSE') {
    return (
      <div className="text-red-500 text-[11px] font-bold uppercase p-4 border border-dashed border-red-500/20 bg-red-50/20 font-mono select-none">
        [-] Query Timed Out. No {resolvedOverTcp ? 'TCP' : 'UDP'} response packet was received from the nameserver.
      </div>
    );
  }

  if (!packet) {
    return (
      <div className="text-ink/40 text-[11px] italic select-none font-mono">
        Packet payload missing for this segment.
      </div>
    );
  }

  const date = new Date(timestamp || DEFAULT_TIMESTAMP);
  const timeString = `${date.toISOString()}`;
  const bytesCount = packet.rawHex ? packet.rawHex.trim().split(/\s+/).length : 0;

  const rawFlags = packet.rawFlags || 0;
  const txIdString = '0x' + (packet.id !== undefined ? packet.id.toString(16).toUpperCase().padStart(4, '0') : '0000');
  const rawFlagsString = '0x' + rawFlags.toString(16).toUpperCase().padStart(4, '0');

  // Decode individual flag bits
  const isResponse = (rawFlags & 0x8000) !== 0;
  const opcode = (rawFlags & 0x7800) >> 11;
  const isAuth = (rawFlags & 0x0400) !== 0;
  const isTruncated = (rawFlags & 0x0200) !== 0;
  const isRecDesired = (rawFlags & 0x0100) !== 0;
  const isRecAvail = (rawFlags & 0x0080) !== 0;
  const isAuthentic = (rawFlags & 0x0020) !== 0;
  const isCheckingDisabled = (rawFlags & 0x0010) !== 0;
  const rcode = rawFlags & 0x000F;

  return (
    <div className="flex flex-col gap-2 mt-3 font-mono">
      {/* 1. Capture Node Frame */}
      <div className="border border-ink/10 bg-base/40 p-3 font-mono flex flex-col gap-1 select-none leading-relaxed mb-1">
        <div className="font-bold flex items-center gap-1.5 text-ink/75 text-[12.5px]">
          <Monitor className="w-3.5 h-3.5 text-accent" />
          Frame: {bytesCount} bytes on wire, {bytesCount} bytes captured
        </div>
        <div className="pl-4 text-[10px] text-ink/50 flex flex-col gap-0.5 mt-1 font-medium select-text border-b border-ink/5 pb-2">
          <span>• Arrival Time: {timeString}</span>
          <span>• Protocols in Frame: {resolvedOverTcp ? 'TCP' : 'UDP'} ({port || 53}) &rarr; DNS</span>
          <span>• Name Server Host Target: {ip || '127.0.0.1'}:{port || 53}</span>
          <span>• Capture Size: {bytesCount} bytes ({bytesCount * 8} bits)</span>
        </div>
        <div className="mt-2.5 p-2.5 border border-dashed border-ink/20 bg-ink/[0.02] font-mono text-[9px] text-ink/65 flex items-start gap-2 select-none leading-relaxed">
          <Info className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-accent">NOTICE:</span> Ethernet/IP/{resolvedOverTcp ? 'TCP' : 'UDP'} framing {resolvedOverTcp ? '(including SYN/ACK handshake) ' : ''}and client IP/MAC are simulated for PCAP compatibility as browsers lack raw socket access. The DNS payload and nameserver IP are real.
          </div>
        </div>
      </div>

      {/* 2A. Main DNS node header */}
      <div className="font-bold text-ink uppercase text-[11px] tracking-wide select-none flex items-center gap-1 border-b border-ink/10 pb-1.5">
        Domain Name System ({isResponse ? 'Response' : 'Query'})
      </div>

      {/* 2B. Transaction ID */}
      <div
        onMouseEnter={() => hoverBytes(0, 2)}
        onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Transaction ID: <strong className="font-bold font-mono">{txIdString}</strong></span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [0-1]</span>
      </div>

      {/* 2C. Flags Collapsible Node */}
      <div className="flex flex-col font-mono">
        <div
          onClick={() => toggleNode('header')}
          onMouseEnter={() => hoverBytes(2, 4)}
          onMouseLeave={() => hoverBytes(null)}
          className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
        >
          <span className="flex items-center font-bold">
            <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.header ? 'rotate-90' : ''}`} />
            Flags: {rawFlagsString} ({isResponse ? 'Response' : 'Query'}, RCODE: {packet.rcode || (isResponse ? 'NOERROR' : 'QUERY')})
          </span>
          <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [2-3]</span>
        </div>

        <AnimatePresence>
          {openNodes.header && (
            <motion.div
              variants={accordionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="overflow-hidden pl-6 border-l border-ink/10 flex flex-col gap-0.5 text-[10px] text-ink/75 py-1"
            >
              <div>{isResponse ? '1' : '0'}... .... .... .... = Response: Message is a {isResponse ? 'response' : 'query'}</div>
              <div>.{opcode.toString(2).padStart(4, '0')} .... .... = Opcode: {getOpcodeDescription(opcode)}</div>
              <div>.... .{isAuth ? '1' : '0'}.. .... .... = Authoritative: Server {isAuth ? 'is' : 'is NOT'} an authority for this zone</div>
              <div>.... ..{isTruncated ? '1' : '0'}. .... .... = Truncated: Message {isTruncated ? 'is' : 'is NOT'} truncated</div>
              <div>.... ...{isRecDesired ? '1' : '0'} .... .... = Recursion desired: Client {isRecDesired ? 'wants' : 'does NOT want'} recursive validation</div>
              {isResponse && (
                <div>.... .... {isRecAvail ? '1' : '0'}... .... = Recursion available: Server {isRecAvail ? 'supports' : 'does NOT support'} recursion</div>
              )}
              <div>.... .... .{isAuthentic ? '1' : '0'}.. .... = Answer authenticated: Data {isAuthentic ? 'is' : 'is NOT'} DNSSEC authenticated</div>
              <div>.... .... ..{isCheckingDisabled ? '1' : '0'}. .... = Checking disabled: DNSSEC validation {isCheckingDisabled ? 'disabled' : 'enabled'}</div>
              <div>.... .... .... {rcode.toString(2).padStart(4, '0')} = Reply code: {getRcodeDescription(rcode, packet.rcode || 'NOERROR')}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 2D. Count Nodes */}
      <div
        onMouseEnter={() => hoverBytes(4, 6)}
        onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Questions count: {packet.qdcount !== undefined ? packet.qdcount : (packet.qdCount !== undefined ? packet.qdCount : 0)}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [4-5]</span>
      </div>
      <div
        onMouseEnter={() => hoverBytes(6, 8)}
        onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Answer RRs count: {packet.ancount !== undefined ? packet.ancount : (packet.anCount !== undefined ? packet.anCount : 0)}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [6-7]</span>
      </div>
      <div
        onMouseEnter={() => hoverBytes(8, 10)}
        onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Authority RRs count: {packet.nscount !== undefined ? packet.nscount : (packet.nsCount !== undefined ? packet.nsCount : 0)}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [8-9]</span>
      </div>
      <div
        onMouseEnter={() => hoverBytes(10, 12)}
        onMouseLeave={() => hoverBytes(null)}
        className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-text"
      >
        <span>Additional RRs count: {packet.arcount !== undefined ? packet.arcount : (packet.arCount !== undefined ? packet.arCount : 0)}</span>
        <span className="text-[9.5px] opacity-40 uppercase font-semibold">bytes [10-11]</span>
      </div>

      {/* 2E. Question Section */}
      {packet.questions && packet.questions.length > 0 && (
        <div className="flex flex-col font-mono mt-1.5">
          <div
            onClick={() => toggleNode('questions')}
            className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
          >
            <span className="flex items-center font-bold text-[11px]">
              <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.questions ? 'rotate-90' : ''}`} />
              Question Section ({packet.questions.length || 0} questions)
            </span>
          </div>

          <AnimatePresence>
            {openNodes.questions && (
              <motion.div
                variants={accordionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="pl-4 flex flex-col gap-2 py-1"
              >
                {packet.questions.map((q, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => hoverBytes(q.startOffset, q.endOffset)}
                    onMouseLeave={() => hoverBytes(null)}
                    className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                  >
                    <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                      <span>• {q.name}: type {q.typeName}, class IN</span>
                      <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                        bytes [{q.startOffset}-{q.endOffset - 1}]
                      </span>
                    </div>
                    <div className="pl-3 flex flex-col gap-0.5 font-medium select-text">
                      <span>Name: {q.name}</span>
                      <span>Type: {q.typeName} ({q.type})</span>
                      <span>Class: IN (0x0001)</span>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 2F. Answers Section */}
      {packet.answers && packet.answers.length > 0 && (
        <div className="flex flex-col font-mono mt-1.5">
          <div
            onClick={() => toggleNode('answers')}
            className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
          >
            <span className="flex items-center font-bold text-[11px]">
              <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.answers ? 'rotate-90' : ''}`} />
              Answers Section ({packet.answers.length} records)
            </span>
          </div>

          <AnimatePresence>
            {openNodes.answers && (
              <motion.div
                variants={accordionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="pl-4 flex flex-col gap-2 py-1"
              >
                {packet.answers.map((ans, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => hoverBytes(ans.startOffset, ans.endOffset)}
                    onMouseLeave={() => hoverBytes(null)}
                    className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                  >
                    <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                      <span>• {ans.name}: type {ans.typeName}, class IN</span>
                      <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                        bytes [{ans.startOffset}-{ans.endOffset - 1}]
                      </span>
                    </div>
                    {renderResourceRecordValue(ans)}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 2G. Authority Section */}
      {packet.authority && packet.authority.length > 0 && (
        <div className="flex flex-col font-mono mt-1.5">
          <div
            onClick={() => toggleNode('authority')}
            className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
          >
            <span className="flex items-center font-bold text-[11px]">
              <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.authority ? 'rotate-90' : ''}`} />
              Authority Section ({packet.authority.length} records)
            </span>
          </div>

          <AnimatePresence>
            {openNodes.authority && (
              <motion.div
                variants={accordionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="pl-4 flex flex-col gap-2 py-1"
              >
                {packet.authority.map((ns, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => hoverBytes(ns.startOffset, ns.endOffset)}
                    onMouseLeave={() => hoverBytes(null)}
                    className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                  >
                    <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                      <span>• {ns.name}: type {ns.typeName}, class IN</span>
                      <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                        bytes [{ns.startOffset}-{ns.endOffset - 1}]
                      </span>
                    </div>
                    {renderResourceRecordValue(ns)}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 2H. Additional Section */}
      {packet.additional && packet.additional.length > 0 && (
        <div className="flex flex-col font-mono mt-1.5">
          <div
            onClick={() => toggleNode('additional')}
            className="pl-2.5 border-l border-ink/15 py-1 hover:bg-accent/5 hover:border-accent transition-colors flex justify-between select-none cursor-pointer"
          >
            <span className="flex items-center font-bold text-[11px]">
              <ChevronRight className={`w-3.5 h-3.5 text-accent transition-transform duration-200 ${openNodes.additional ? 'rotate-90' : ''}`} />
              Additional Section ({packet.additional.length} records)
            </span>
          </div>

          <AnimatePresence>
            {openNodes.additional && (
              <motion.div
                variants={accordionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="pl-4 flex flex-col gap-2 py-1"
              >
                {packet.additional.map((add, idx) => (
                  <div
                    key={idx}
                    onMouseEnter={() => hoverBytes(add.startOffset, add.endOffset)}
                    onMouseLeave={() => hoverBytes(null)}
                    className="pl-3 border-l-2 border-ink/20 py-1 hover:bg-accent/5 hover:border-accent flex flex-col gap-0.5 text-[10px] text-ink/75"
                  >
                    <div className="font-bold text-[11px] text-ink font-mono flex justify-between select-text">
                      <span>• {add.name}: type {add.typeName}, class IN</span>
                      <span className="text-[9px] opacity-40 uppercase font-semibold select-none">
                        bytes [{add.startOffset}-{add.endOffset - 1}]
                      </span>
                    </div>
                    {renderResourceRecordValue(add)}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// Helper: Dissects RR Type Value fields
function renderResourceRecordValue(ans) {
  if (ans.isOpt && ans.optDetails) {
    const opt = ans.optDetails;
    return (
      <div className="pl-3 flex flex-col gap-0.5 font-medium select-text">
        <span>Name: {ans.name}</span>
        <span>Type: OPT (41)</span>
        <span>Sender's UDP payload size: {opt.udpPayloadSize} bytes</span>
        <span>EDNS0 Version: {opt.version}</span>
        <span>DO bit (DNSSEC OK): {opt.dnssecOk ? '1 (Accepts validation records)' : '0'}</span>
        <span>Extended RCODE: 0x{opt.extendedRcode.toString(16).toUpperCase().padStart(2, '0')}</span>

        {/* ECS Option values */}
        {opt.options && opt.options.length > 0 && (
          <div className="mt-1 pl-3 border-l border-ink/10 flex flex-col">
            <span className="font-bold text-accent uppercase text-[8.5px] select-none tracking-wide">EDNS Options:</span>
            {opt.options.map((o, idx) => (
              <div key={idx} className="pl-1">
                • {o.name}: {typeof o.value === 'object' ? `${o.value.address}/${o.value.sourceMask} (Scope mask: /${o.value.scopeMask})` : o.value}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // standard fields
  return (
    <div className="pl-2 flex flex-col font-medium select-text">
      <span>Name: {ans.name}</span>
      <span>Type: {ans.typeName} ({ans.typeNum})</span>
      <span>TTL: {ans.ttl}s</span>
      {ans.typeNum === 1 || ans.typeNum === 28 || ans.typeNum === 5 || ans.typeNum === 2 || ans.typeNum === 12 ? (
        <span>Address/Target: {ans.value}</span>
      ) : ans.typeNum === 15 ? (
        <span>MX Preference: {ans.value.preference} | Mail server exchange: {ans.value.exchange}</span>
      ) : ans.typeNum === 33 && typeof ans.value === 'object' ? ( // SRV
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Priority: {ans.value.priority} | Weight: {ans.value.weight}</span>
          <span>Port: {ans.value.port}</span>
          <span>Target host: {ans.value.target}</span>
        </div>
      ) : ans.typeNum === 6 ? (
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Primary DNS nameserver: {ans.value.mname}</span>
          <span>Admin mailbox: {ans.value.rname}</span>
          <span>Serial: {ans.value.serial}</span>
          <span>Refresh: {ans.value.refresh}s | Retry: {ans.value.retry}s</span>
          <span>Expire: {ans.value.expire}s | Minimum TTL: {ans.value.minimum}s</span>
        </div>
      ) : ans.typeNum === 46 && typeof ans.value === 'object' ? ( // RRSIG
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Type Covered: {ans.value.typeCovered}</span>
          <span>Algorithm: {getAlgorithmDescription(ans.value.algorithm, ans.value.algorithmName)}</span>
          <span>Key Tag: {ans.value.keyTag}</span>
          <span>Signature Inception: {ans.value.inceptionDate}</span>
          <span>Signature Expiration: {ans.value.expirationDate}</span>
          <span>Signer hostname: {ans.value.signerName}</span>
        </div>
      ) : ans.typeNum === 48 && typeof ans.value === 'object' ? ( // DNSKEY
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Key Flags: {ans.value.flags} (Zone Key: {ans.value.isZoneKey ? '1' : '0'}, KSK: {ans.value.isSep ? '1' : '0'})</span>
          <span>Protocol: {ans.value.protocol}</span>
          <span>Algorithm: {getAlgorithmDescription(ans.value.algorithm, ans.value.algorithmName)}</span>
          <span>Key Length: {ans.value.keyLength} bytes</span>
        </div>
      ) : ans.typeNum === 43 && typeof ans.value === 'object' ? ( // DS
        <div className="pl-2 border-l border-ink/10 flex flex-col gap-0.5">
          <span>Key Tag: {ans.value.keyTag}</span>
          <span>Algorithm: {getAlgorithmDescription(ans.value.algorithm, ans.value.algorithmName)}</span>
          <span>Digest Type: {ans.value.digestTypeName} ({ans.value.digestType})</span>
          <span className="break-all">Digest hash: {ans.value.digest}</span>
        </div>
      ) : (
        <span>Value: {typeof ans.value === 'object' ? JSON.stringify(ans.value) : ans.value}</span>
      )}
    </div>
  );
}

export default memo(DnsDissectorTree);
