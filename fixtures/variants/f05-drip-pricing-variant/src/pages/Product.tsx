import { Link } from "react-router-dom";

export default function Product() {
  return (
    <div className="page">
      <h1>Organic Coffee</h1>
      <p>₹799</p>
      <Link to="/cart">
        <button type="button">Add to cart</button>
      </Link>
    </div>
  );
}
