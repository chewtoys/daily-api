import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type KeywordStatus = 'pending' | 'allow' | 'deny' | 'synonym';

@Entity()
export class Keyword {
  @PrimaryColumn({ type: 'text' })
  @Index('IDX_keyword_value')
  value: string;

  @Column({
    default: 'pending',
  })
  @Index('IDX_keyword_status')
  status: KeywordStatus;

  @Column({ default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'text', nullable: true })
  synonym?: string;

  @UpdateDateColumn()
  @Index('IDX_keyword_updatedAt')
  updatedAt: Date;

  @Column({ default: 1 })
  @Index('IDX_keyword_occurrences')
  occurrences: number;
}
