import { motion } from 'framer-motion';

export default function BentoBox({ title, description, icon, delay = 0 }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.4, delay }}
      className="group relative bg-[#F0EDE8] border-2 border-[#0D0D0D] p-6 hover:-translate-y-1 transition-transform duration-300"
    >
      <div className="absolute top-0 left-0 w-0 h-1 bg-[#FF4D00] transition-all duration-300 group-hover:w-full" />
      
      <div className="mb-4 text-[#FF4D00] text-2xl">
        {icon}
      </div>
      
      <h3 className="font-display font-bold text-lg mb-2 uppercase tracking-tight">
        {title}
      </h3>
      
      <p className="font-mono text-xs opacity-60 leading-relaxed">
        {description}
      </p>
    </motion.div>
  );
}
