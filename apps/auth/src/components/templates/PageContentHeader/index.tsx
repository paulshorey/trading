import classes from './index.module.scss'

type Props = {
  title: string | React.ReactNode
  subtitle?: string | React.ReactNode
}

export default function PageContentHeader({ title, subtitle }: Props) {
  return (
    <header className={classes.container}>
      {/* <span className={classes.back}>
        <FontAwesomeIcon size="xl" icon={faAngleLeft} />
      </span> */}
      <div className={`${classes.title}`}>{title}</div>
      {!!subtitle && <div className={`${classes.subtitle}`}>{subtitle}</div>}
    </header>
  )
}
