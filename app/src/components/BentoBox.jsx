import { motion } from 'framer-motion';

export default function BentoBox({ title, text, icon, decoration, className = "", delay = 0 }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 30 }} 
      whileInView={{ opacity: 1, y: 0 }} 
      viewport={{ once: true, margin: "-50px" }} 
      transition={{ duration: 0.6, delay: delay, ease: [0.16, 1, 0.3, 1] }}
      className={`brutalist-bento sharp-border group relative overflow-hidden ${className}`}
    >
      <div className="absolute right-[-10%] bottom-[-10%] opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity duration-500">
        {decoration}
      </div>
      <div className="absolute top-0 left-0 w-full h-[2px] bg-accent -translate-x-full group-hover:translate-x-0 transition-transform duration-500 ease-out z-10"></div>
      <div className="font-mono text-xs uppercase opacity-40 mb-8 z-10">{icon}</div>
      <div className="z-10">
        <h3 className="font-display font-black tracking-tighter text-xl uppercase mb-2">{title}</h3>
        <p className="font-mono text-xs opacity-70 leading-relaxed">{text}</p>
      </div>
    </motion.div>
  );
}
