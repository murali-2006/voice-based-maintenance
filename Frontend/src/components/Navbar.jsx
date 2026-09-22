import { UserRoundCog } from "lucide-react";
import "./Navbar.css";

function Navbar() {
  return (
    <header className="navbar">

      <div className="navbar-title">
        <h3>Service Engineer</h3>

        <span>
          Maintenance Management System
        </span>
      </div>

      <div className="navbar-user">
        <UserRoundCog
          size={32}
          className="user-icon"
        />

        <div>
          <strong>Service Engineer</strong>
          <small>Engineer Access</small>
        </div>
      </div>

    </header>
  );
}

export default Navbar;