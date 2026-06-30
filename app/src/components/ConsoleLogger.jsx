import { useEffect, useRef, useMemo } from 'react';

const getHopsLogs = (hopsArray, activeStepIndex, domVal, recTypeVal) => {
  const logLines = [];
  if (!hopsArray || hopsArray.length === 0) return logLines;

  // Filter hops that are reached based on activeStepIndex
  const activeHops = hopsArray.filter(hop => {
    if (hop.type === 'CLIENT' || hop.type === 'LOCAL') {
      return activeStepIndex >= 1;
    }
    return hop.step !== undefined && hop.step <= activeStepIndex;
  });

  for (let i = 0; i < activeHops.length; i++) {
    const hop = activeHops[i];
    const timeStr = `[${(hop.cumulativeMs / 1000).toFixed(3)}s]`;
    const hopDomain = hop.queryDomain || domVal;

    if (hop.type === 'CLIENT') {
      logLines.push({ time: timeStr, source: 'CLIENT', text: `Initiating trace query for "${hopDomain.toUpperCase()}" (Record Type: ${recTypeVal})` });
      if (recTypeVal === 'ALL') {
        logLines.push({ time: timeStr, source: 'RFC-8482', text: `Notice: ANY query deprecated by RFC 8482. Resolving types A, AAAA, MX, TXT, NS in parallel.` });
      }
      const hasNextLocal = activeHops.some(h => h.type === 'LOCAL');
      if (hasNextLocal) {
        const nextHop = hopsArray.find(h => h.type === 'LOCAL');
        const isCacheHit = nextHop && nextHop.label && nextHop.label.includes('Cache Hit');
        if (isCacheHit) {
          logLines.push({ time: timeStr, source: 'CLIENT', text: `Sending query to Recursive Resolver at ${nextHop.ip || '1.1.1.1'}` });
        } else {
          logLines.push({ time: timeStr, source: 'CLIENT', text: `Sending UDP query packet payload to Recursive Resolver` });
        }
      }
    } else if (hop.type === 'LOCAL') {
      const isCacheHit = hop.label && hop.label.includes('Cache Hit');
      if (isCacheHit) {
        logLines.push({ time: timeStr, source: 'LOCAL', text: `Received request packet. Checking virtual caching resolver...` });
        if (hop.response && hop.response.rcode === 'NXDOMAIN') {
          logLines.push({ time: timeStr, source: 'LOCAL', text: `Negative Cache Hit! Target domain does not exist (NXDOMAIN cached).` });
        } else {
          logLines.push({ time: timeStr, source: 'LOCAL', text: `Cache Hit! Virtual caching resolver returned active record set from memory.` });
        }
        const answersList = hop.response?.answers || [];
        logLines.push({ time: timeStr, source: 'CLIENT', text: `Received response payload: ${answersList.length} records resolved. Iterative sequence completed.` });
      } else {
        logLines.push({ time: timeStr, source: 'LOCAL', text: `Query received by Recursive Resolver (${hop.ip}).` });
        logLines.push({ time: timeStr, source: 'LOCAL', text: `No active cache record found. Forwarding query to Root Authority hints...` });
      }
    } else if (hop.type === 'ROOT') {
      logLines.push({ time: timeStr, source: 'ROOT', text: `Querying Root Authority: ${hop.label} (${hop.ip})` });
      logLines.push({ time: timeStr, source: 'ROOT', text: `Received delegation referral (RCODE: ${hop.response?.rcode || 'NOERROR'}). Found ${hop.response?.authority?.length || 13} TLD servers.` });
    } else if (hop.type === 'TLD') {
      logLines.push({ time: timeStr, source: 'TLD', text: `Querying TLD Server: ${hop.label} (${hop.ip})` });
      logLines.push({ time: timeStr, source: 'TLD', text: `Received delegation referral (RCODE: ${hop.response?.rcode || 'NOERROR'}). Found ${hop.response?.authority?.length || 4} authoritative servers.` });
    } else if (hop.type === 'AUTH') {
      logLines.push({ time: timeStr, source: 'AUTH', text: `Querying Authoritative Server: ${(hop.queryDomain || '').toUpperCase()} (${hop.ip})` });
      const rcode = hop.response?.rcode || 'NOERROR';
      const answersCount = hop.response?.answers?.length || 0;
      if (rcode === 'NXDOMAIN') {
        logLines.push({ time: timeStr, source: 'AUTH', text: `NXDOMAIN response code returned. Requested domain target does not exist!` });
      } else {
        logLines.push({ time: timeStr, source: 'AUTH', text: `Final answer received (RCODE: ${rcode}, AA Flag: ${hop.response?.flags?.includes('AA') ? '1' : '0'}). Found ${answersCount} answers.` });
        
        const isFinalStepReached = activeStepIndex >= hop.step + 2;
        if (isFinalStepReached) {
          logLines.push({ time: timeStr, source: 'LOCAL', text: `Iterative sequence completed. Retransmitting payload to Stub Resolver.` });
        }
      }
    } else if (hop.type === 'CNAME_REDIRECT') {
      logLines.push({ time: timeStr, source: 'CNAME', text: `CNAME alias redirection: "${hop.cnameFrom.toUpperCase()}" -> "${hop.cnameTo.toUpperCase()}"` });
      logLines.push({ time: timeStr, source: 'CLIENT', text: `Redirecting resolver chain to target host.` });
    }
  }

  return logLines;
};

export default function ConsoleLogger({
  hops,
  activeStep,
  domain,
  recordType,
  isBenchmarkMode,
  playbackState,
  isNxDomain,
  benchmarkData
}) {
  const logLines = useMemo(() => getHopsLogs(hops, activeStep, domain, recordType), [
    hops,
    activeStep,
    domain,
    recordType
  ]);
  
  const consoleEndRef = useRef(null);

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logLines.length]);

  const isCompletedLayout = isBenchmarkMode && (playbackState === 'COMPLETE' || isNxDomain) && benchmarkData;

  return (
    <div
      className={`flex flex-col bg-ink p-3 font-mono text-[9.1px] text-[#A6E22E] border border-ink overflow-hidden h-36 select-text ${
        isCompletedLayout ? 'md:col-span-3' : 'w-full'
      }`}
    >
      <div className="text-[8px] text-accent font-bold uppercase tracking-wider mb-1 select-none border-b border-base/10 pb-1 flex justify-between shrink-0">
        <span>Observatory Logs</span>
        <span className="animate-pulse">CONNECTED</span>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 select-text scrollbar-thin">
        {logLines.map((line, idx) => (
          <div key={idx} className="flex gap-2 items-start leading-normal">
            <span className="text-[#66D9EF] select-none shrink-0">{line.time}</span>
            <span className="text-[#F92672] select-none font-bold shrink-0">[{line.source}]</span>
            <span className="text-base select-text break-all text-[#F0EDE8]">{line.text}</span>
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>
    </div>
  );
}
