import { Link } from "react-router-dom";
import "./NotFound.css";

function NotFound() {
  return (
    <div className="not-found-page">

      <div className="not-found-container">
        <h1>404</h1>

        <h2>Page Not Found</h2>

        <p>
          The page you are looking for does not exist.
        </p>

        <Link to="/">
          Go to Login
        </Link>
      </div>

    </div>
  );
}

export default NotFound;