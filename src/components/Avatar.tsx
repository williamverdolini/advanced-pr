import * as React from "react";
import { initialsFromName } from "../core/initials";

export interface AvatarProps {
  name: string;
  imageUrl?: string;
  className?: string;
}

/**
 * The author's picture, with their initials underneath it.
 *
 * The picture is a plain `<img>`, the way the native Files tab mounts it. It may
 * not load: the tab is an iframe on another origin, so the browser sends no
 * Azure DevOps cookie with the request, and whether the avatar endpoint answers
 * one without it is the organization's business rather than ours. The initials
 * are therefore not a decoration — they are what is on screen whenever it does
 * not, and the reason a failure looks like a design instead of a broken image.
 */
export function Avatar({ name, imageUrl, className }: AvatarProps): React.ReactElement {
  const [failed, setFailed] = React.useState(false);

  // A new picture deserves a new attempt: the same element is reused for the
  // next author as the tree is re-rendered.
  React.useEffect(() => setFailed(false), [imageUrl]);

  return (
    <span
      className={className ? `avatar ${className}` : "avatar"}
      // The name is on the wrapper rather than on the image's `alt`, so it is
      // announced once whichever of the two is showing.
      aria-label={name}
      title={name}
    >
      {imageUrl && !failed ? (
        <img src={imageUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initialsFromName(name)}</span>
      )}
    </span>
  );
}
