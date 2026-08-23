import { cn } from '../../lib/utils';

interface TableProps {
  children: React.ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm text-left text-gray-500', className)}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children, className }: TableProps) {
  return (
    <thead className={cn('text-xs text-gray-700 uppercase bg-gray-50', className)}>
      {children}
    </thead>
  );
}

export function TableBody({ children, className }: TableProps) {
  return <tbody className={className}>{children}</tbody>;
}

export function TableRow({ children, className }: TableProps) {
  return (
    <tr className={cn('bg-white border-b hover:bg-gray-50 transition-colors', className)}>
      {children}
    </tr>
  );
}

export function TableHeader({ children, className }: TableProps) {
  return <th className={cn('px-6 py-3 font-semibold', className)}>{children}</th>;
}

export function TableCell({ children, className }: TableProps) {
  return <td className={cn('px-6 py-4', className)}>{children}</td>;
}
