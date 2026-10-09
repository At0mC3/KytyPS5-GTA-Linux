// Trophy grades: 1 Platinum, 2 Gold, 3 Silver, 4 Bronze.
export const GRADE_COLORS: Record<number, string> = { 1: '#7fc8ff', 2: '#f5c542', 3: '#c4cad2', 4: '#cd7f4f' };
export const GRADE_NAMES: Record<number, string> = { 1: 'Platinum', 2: 'Gold', 3: 'Silver', 4: 'Bronze' };

export function TrophyCup({ grade, size = 20 }: { grade: number; size?: number }) {
	const color = GRADE_COLORS[grade] ?? '#8a8a8a';
	return (
		<svg className="trophy-cup" width={size} height={size} viewBox="0 0 20 20" aria-label={GRADE_NAMES[grade]}>
			<path d="M6 2.5h8v4.2a4 4 0 0 1-8 0Z" fill={color} />
			<path d="M6 4H3.5v.8A2.8 2.8 0 0 0 6.3 7.6M14 4h2.5v.8a2.8 2.8 0 0 1-2.8 2.8" fill="none" stroke={color} strokeWidth="1.4" />
			<path d="M9 10.5h2v3H9Z" fill={color} />
			<path d="M6.5 14.5h7v2.5h-7Z" fill={color} />
		</svg>
	);
}
