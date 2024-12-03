import { toast } from 'react-hot-toast';

type Props = {
  type?: 'success' | 'error' | 'loading' | 'custom';
  title: string;
  description?: string;
  x?: boolean;
  [key: string]: any;
};

export default function makeToast({ type = 'success', title, description, x, ...rest }: Props) {
  const options = rest;
  if (x) {
    options.id = 'oneToastAtATime';
  }
  if (!options.duration) {
    if (type === 'error') options.duration = 10000;
    else options.duration = 5000;
  }
  let Content = null;
  const Message = [];
  if (description) {
    Message.push(<b style={{ fontSize: '100%', lineHeight: '1.25', display: 'block' }}>{title}</b>);
    Message.push(<span style={{ fontSize: '85%', lineHeight: '1' }}>{description}</span>);
  } else {
    Message.push(title);
  }
  if (x) {
    Content = (
      <div className="flex justify-center">
        <div>{Message}</div>
        <button
          type="button"
          onClick={() => toast.dismiss('oneToastAtATime')}
          className="pl-[15px] mr-[-5px] text-stone-400"
          style={{ transform: 'scaleY(0.875)' }}
        >
          <b>x</b>
        </button>
      </div>
    );
  } else {
    Content = <div>{Message}</div>;
  }
  toast[type](Content, options);
}
